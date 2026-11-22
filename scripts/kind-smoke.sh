#!/usr/bin/env bash
# A real cluster for the Kubernetes examples (PL-120): kind starts one in Docker, the sqlite overlay
# goes on it and must become ready under the restricted Pod Security level, then the postgres
# overlay the same. Everything is removed at the end, the cluster and its node image included.
# Not in CI (a cluster's node image is about a gigabyte for the runner's disk): run it by hand
# after changing the examples, from a machine with Docker:
#   docker run --rm --network kind -v /var/run/docker.sock:/var/run/docker.sock \
#     -v "$PWD:/work" -w /work docker:29 sh -c 'apk add -q bash curl && bash scripts/kind-smoke.sh'
# (`docker network create kind` first if the network does not exist yet.)
# IMAGE=registry.gitlab.com/killswitch10/pecklist:edge tries another build than the examples' tag;
# a local image (not in a registry) is loaded into the cluster with `kind load`.
set -euo pipefail

KIND_VERSION=0.33.0
KIND_SHA256=aee6151561422756b764a4ae28e7f44cda5af5a9eead3cc9985112b1de8d8e0d
KUBECTL_VERSION=1.37.2
KUBECTL_SHA256=c04487523e7aa7d1493f7808174c899db93d7a9cf57531420cd76b9bd415f8f4
NODE_IMAGE=kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5
CLUSTER=pecklist-smoke

root="$(cd "$(dirname "$0")/.." && pwd)"
tools="$(mktemp -d)"
export KUBECONFIG="$tools/kubeconfig"
curl -fsSL "https://github.com/kubernetes-sigs/kind/releases/download/v${KIND_VERSION}/kind-linux-amd64" -o "$tools/kind"
echo "$KIND_SHA256  $tools/kind" | sha256sum -c - >/dev/null
curl -fsSL "https://dl.k8s.io/release/v${KUBECTL_VERSION}/bin/linux/amd64/kubectl" -o "$tools/kubectl"
echo "$KUBECTL_SHA256  $tools/kubectl" | sha256sum -c - >/dev/null
chmod +x "$tools/kind" "$tools/kubectl"
kind() { "$tools/kind" "$@"; }
kubectl() { "$tools/kubectl" "$@"; }

cleanup() {
  kind delete cluster --name "$CLUSTER" >/dev/null 2>&1 || true
  docker image rm "${NODE_IMAGE%:*@*}@${NODE_IMAGE#*@}" >/dev/null 2>&1 || true
  rm -rf "$tools"
}
trap cleanup EXIT

kind create cluster --name "$CLUSTER" --image "$NODE_IMAGE" --wait 120s
# Reach the API server over the kind network (this script runs in a container on it).
kind export kubeconfig --name "$CLUSTER" --internal

# The examples as written, or another image.
work="$tools/examples"
cp -r "$root/examples/kubernetes" "$work"
if [ -n "${IMAGE:-}" ]; then
  name="${IMAGE%:*}"; tag="${IMAGE##*:}"
  for file in "$work"/base/kustomization.yaml "$work"/components/backup/kustomization.yaml; do
    sed -i "/name: ${name//\//\\/}/{n;s/newTag: .*/newTag: $tag/}" "$file"
  done
  if docker image inspect "$IMAGE" >/dev/null 2>&1; then kind load docker-image "$IMAGE" --name "$CLUSTER"; fi
fi

ready() { # what
  kubectl -n pecklist rollout status "$1" --timeout=300s
}
health() {
  kubectl -n pecklist port-forward svc/pecklist 18080:80 >/dev/null 2>&1 &
  local forward=$!
  local code=000
  for _ in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/healthz || true)"
    [ "$code" = 200 ] && break
    sleep 1
  done
  kill "$forward" 2>/dev/null || true
  echo "healthz $code"
  [ "$code" = 200 ]
}

echo "--- sqlite"
kubectl apply -k "$work/overlays/sqlite"
ready deployment/pecklist
health
kubectl -n pecklist logs deployment/pecklist | grep -iE 'exception|denied|read-only' && { echo "errors in the log"; exit 1; } || true
kubectl delete namespace pecklist --wait=true

echo "--- postgres"
kubectl create namespace pecklist
password="$(head -c 18 /dev/urandom | base64 | tr -d '/+=')"
kubectl -n pecklist create secret generic pecklist-db \
  --from-literal=password="$password" \
  --from-literal=connection="Host=pecklist-postgres;Username=pecklist;Password=$password;Database=pecklist"
kubectl apply -k "$work/overlays/postgres"
ready statefulset/pecklist-postgres
ready deployment/pecklist
health
kubectl -n pecklist logs deployment/pecklist | grep -iE 'exception|denied' && { echo "errors in the log"; exit 1; } || true
echo "--- passed"
