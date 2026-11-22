#!/usr/bin/env bash
# Checks the Kubernetes examples (PL-120): every overlay builds with kustomize, and what it builds
# is valid against the Kubernetes schemas (kubeconform, strict), the Gateway API's HTTPRoute from
# the CRDs catalog. The PeckList image tag is the same everywhere it is written.
# Runs in CI (the k8s-manifests job) and locally: bash scripts/check-kubernetes.sh
set -euo pipefail

KUSTOMIZE_VERSION=5.8.3
KUSTOMIZE_SHA256=cb9e31198d3f63b44848bd0afc4c8efc56e6cfef9c93a4a39a211940e6decd61
KUBECONFORM_VERSION=0.8.0
KUBECONFORM_SHA256=9bc2bffbf71f261128533edaf912153948b7ff238f9a531ae6d34466ec287883
# The oldest Kubernetes the examples are meant for.
KUBERNETES_VERSION=1.30.0

root="$(cd "$(dirname "$0")/.." && pwd)"
examples="$root/examples/kubernetes"
tools="${K8S_TOOLS_DIR:-$root/.k8s-tools}"
mkdir -p "$tools"

fetch() { # name url sha256
  local name=$1 url=$2 sum=$3 archive="$tools/$1.tar.gz"
  if [ ! -x "$tools/$name" ]; then
    curl -fsSL "$url" -o "$archive"
    echo "$sum  $archive" | sha256sum -c - >/dev/null
    tar -xzf "$archive" -C "$tools" "$name"
    rm -f "$archive"
  fi
}
fetch kustomize \
  "https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2Fv${KUSTOMIZE_VERSION}/kustomize_v${KUSTOMIZE_VERSION}_linux_amd64.tar.gz" \
  "$KUSTOMIZE_SHA256"
fetch kubeconform \
  "https://github.com/yannh/kubeconform/releases/download/v${KUBECONFORM_VERSION}/kubeconform-linux-amd64.tar.gz" \
  "$KUBECONFORM_SHA256"

status=0
for overlay in "$examples"/base "$examples"/overlays/*/; do
  name="${overlay%/}"; name="${name#"$examples"/}"
  if ! out="$("$tools/kustomize" build "$overlay" 2>&1)"; then
    echo "FAIL $name: kustomize build"; echo "$out"; status=1; continue
  fi
  if ! report="$(printf '%s\n' "$out" | "$tools/kubeconform" -strict -summary \
      -kubernetes-version "$KUBERNETES_VERSION" \
      -schema-location default \
      -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/04af58d740718c4dc719441bf39fb284c784f4a8/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json' \
      - 2>&1)"; then
    echo "FAIL $name: kubeconform"; echo "$report"; status=1; continue
  fi
  echo "ok   $name: $(printf '%s\n' "$report" | tail -1)"
done

# One version everywhere: the base's tag, and the components that bring their own pods.
# find and plain grep: BusyBox's grep (the CI image) has no --include.
tags="$(find "$examples" -name kustomization.yaml -exec grep -h -A1 'name: registry.gitlab.com/killswitch10/pecklist' {} + \
  | sed -n 's/^ *newTag: *//p' | sort -u)"
if [ "$(printf '%s\n' "$tags" | wc -l)" -ne 1 ]; then
  echo "FAIL the PeckList image tag differs between kustomizations:"; printf '%s\n' "$tags"; status=1
else
  echo "ok   image tag $tags everywhere"
fi
exit $status
