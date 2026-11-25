# Kubernetes

Ready-made files for k3s, Talos, MicroK8s, kind or a cloud cluster are in
[`examples/kubernetes`](https://gitlab.com/killswitch10/pecklist/-/tree/main/examples/kubernetes):
a Kustomize **base** and **overlays** for the usual setups, built from **components** you can mix
in your own. You need Kubernetes 1.30 or newer (what the files are checked against), `kubectl` with
Kustomize built in, and a cluster with a default storage class.

## Quick start

```bash
kubectl apply -k examples/kubernetes/overlays/sqlite
kubectl -n pecklist rollout status deployment/pecklist
kubectl -n pecklist logs deployment/pecklist      # the first admin password, printed once
kubectl -n pecklist port-forward svc/pecklist 8080:80
```

Open [http://localhost:8080](http://localhost:8080). Read [first start](../getting-started/first-start.md) for what comes
next. To choose the first admin password instead, make the optional `pecklist-secrets` Secret
before applying ([`secret.example.yaml`](https://gitlab.com/killswitch10/pecklist/-/blob/main/examples/kubernetes/base/secret.example.yaml)):

```bash
kubectl create namespace pecklist
kubectl -n pecklist create secret generic pecklist-secrets \
  --from-literal=ADMIN_PASSWORD='a password of 12 or more characters'
```

## What is in the base

- **A Deployment** of the image with one replica, a **Service** on port 80, and two
  **PersistentVolumeClaims**: `pecklist-data` (5 GiB, the database and its snapshots in `/data`)
  and `pecklist-files` (10 GiB, attached files in `/files`, so they can sit on other storage).
- **Settings** in the `pecklist-settings` ConfigMap, made from
  [`base/pecklist.env`](https://gitlab.com/killswitch10/pecklist/-/blob/main/examples/kubernetes/base/pecklist.env):
  any name from [all settings](../configuration/reference.md), one per line. Secret settings go in
  the `pecklist-secrets` Secret, or in files from a mounted Secret with the `*_FILE` settings, as
  the components below do.
- **Probes**: a startup probe on `/healthz` that allows five minutes for the first migration of a
  big database, then readiness on `/healthz` (which checks the database too) and liveness on the
  port alone, so a database outage takes the pod out of the Service instead of restarting it.
- **A locked-down pod**: the image's own user (uid 1654), a read-only root filesystem with a
  writable `/tmp`, no privilege escalation and no Linux capabilities. The `pecklist` namespace
  enforces the `restricted` Pod Security level.
- **Resources**: a request of 0.1 CPU and 256 MiB, and a memory limit of 1 GiB, which the runtime
  sizes its heap from ([memory](../guides/monitoring.md#memory)). That is plenty for a household;
  give a server with many people and tens of thousands of tasks more.

### One pod

PeckList runs as **exactly one pod**, and the Deployment uses `strategy: Recreate` so the old pod
stops before the new one starts. SQLite takes one writer, and live updates and the change notifier
live inside the server's process, so a second pod would neither share the database file nor hear
about the first one's changes. PostgreSQL does not change this. Plan for a short gap while the pod
is replaced during an upgrade: the apps keep working offline and catch up.

## Overlays

| Overlay    | What it adds                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------- |
| `sqlite`   | Nothing: the base as it is. The default.                                                     |
| `postgres` | PostgreSQL instead of SQLite, with a small StatefulSet for it.                              |
| `ingress`  | HTTPS through an Ingress, with a certificate from cert-manager.                              |
| `gateway`  | HTTPS through the Gateway API: an HTTPRoute on a Gateway you already run.                    |
| `oidc`     | Single sign-on with an OpenID Connect provider, behind the Ingress.                          |
| `full`     | All of it, plus the nightly backup and the network policy: a starting point.              |

Some need a Secret before their pod can start: `postgres` and `full` need `pecklist-db`
([PostgreSQL](#postgresql)), `oidc` and `full` need `pecklist-oidc` ([single sign-on](#single-sign-on)),
and the backup job in `full` needs `pecklist-backup` ([backups](#backups)). Until then those pods
do not start.

The overlays are short lists of the components in
[`components/`](https://gitlab.com/killswitch10/pecklist/-/tree/main/examples/kubernetes/components).
For your own setup, copy one and change it, for example PostgreSQL behind a Gateway with backups:

```yaml title="kustomization.yaml"
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: pecklist
resources:
  - ../postgres
components:
  - ../../components/gateway
  - ../../components/backup
```

### HTTPS and the public address

The `ingress` and `gateway` components set two settings that sign-in and secure cookies depend on.
Change both, and `tasks.example.com` in the Ingress or HTTPRoute:

- `PUBLIC_URL`: the address people open, such as `https://tasks.example.com`. Sign-in callbacks
  and the links the server makes use it.
- `TRUSTED_PROXIES`: who may tell the server the visitor's address. The ingress controller's pods
  are on the cluster's pod network, often on another node than PeckList, so this is the pod
  network's range: `10.42.0.0/16` on k3s, often `10.244.0.0/16` with kubeadm. Without it, every
  visitor looks like the controller, and sign-in limits would count them all as one.

Two things go with that:

- The controller must see the visitor's address in the first place. Behind a `LoadBalancer` or
  `NodePort` Service with the default `externalTrafficPolicy: Cluster`, the node rewrites it to its
  own, so every visitor still looks the same. Set `externalTrafficPolicy: Local` on the
  controller's Service, or use the PROXY protocol if your load balancer offers it.
- Trusting the pod network trusts **every** pod in the cluster to name the visitor. Add the
  `network-policy` component so only the ingress controller and the backup job reach PeckList
  (it lets in ingress-nginx from its own namespace and k3s's built-in Traefik from `kube-system`;
  change it if your controller runs elsewhere). A controller on `hostNetwork` connects from the
  node's address, which no pod selector matches: admit the nodes' addresses with an `ipBlock`.

The Ingress's annotations are for ingress-nginx: room for 200 MB uploads (backups to restore), and
no buffering with a one-hour read timeout, so live updates (`/api/events`) arrive at once and their
connection stays open. Other controllers need their own equivalents, if any; Traefik needs none.
See [reverse proxy](reverse-proxy.md) for why. The `HTTPRoute`'s `timeouts` need Gateway API
v1.2 or newer.

### PostgreSQL

The `postgres` component points the server at PostgreSQL through a connection string in the
`pecklist-db` Secret. The `postgres` overlay adds a one-pod PostgreSQL StatefulSet, enough for a
household or a team. For more (replicas, point-in-time recovery), run an operator such as
CloudNativePG, or a managed database, and use the component on its own with the connection string
pointing there. Make the Secret before applying:

```bash
kubectl create namespace pecklist
kubectl -n pecklist create secret generic pecklist-db \
  --from-literal=password='a long random password' \
  --from-literal=connection='Host=pecklist-postgres;Username=pecklist;Password=a long random password;Database=pecklist'
kubectl apply -k examples/kubernetes/overlays/postgres
```

PeckList waits for the database and restarts until it answers, so the first start can take a
minute. [Database](../configuration/database.md) has the details, including moving from SQLite.

### Single sign-on

The `oidc` component adds one provider named `sso`; change its address and client ID, and see
[single sign-on](../guides/single-sign-on.md) for the other settings. The client secret comes from a Secret:

```bash
kubectl -n pecklist create secret generic pecklist-oidc --from-literal=client-secret='...'
```

## Upgrading

Change the tag in `base/kustomization.yaml` (and in `components/backup/kustomization.yaml` if you
use it), then apply again:

```yaml
images:
  - name: registry.gitlab.com/killswitch10/pecklist
    newTag: 0.14.0
```

The pod is replaced, and the server migrates the database as it starts. The tags are in
[image tags](docker.md#image-tags); a minor tag such as `0.14` follows fixes by itself when the pod
restarts (with `imagePullPolicy: Always`). Before a minor release, read its breaking changes:
[upgrading](../guides/upgrading.md).

## Backups

The server writes **snapshots** to `/data/snapshots` on its own (`BACKUP_SCHEDULE`, daily by
default): see [backups](../guides/backups.md). They sit on the database's volume, so they help with
mistakes, not with losing that volume.

The **backup component** adds a CronJob that asks the running server for a full export every night
at 03:30 and keeps two weeks of dated copies on a volume of its own, `pecklist-backup`. Because it
goes through the server's API, it works with SQLite on a ReadWriteOnce volume (which a second pod
could not mount) and with PostgreSQL alike. It needs an API key with the admin permission from a
super admin: make one under **Settings > Account > API keys**, then:

```bash
kubectl -n pecklist create secret generic pecklist-backup --from-literal=token='pl_...'
```

To run it now rather than at night:

```bash
kubectl -n pecklist create job --from=cronjob/pecklist-backup backup-now
```

An export made with a key leaves out the server's session secrets and the passwords saved on the
settings page, so restoring it signs everyone out ([backups](../guides/backups.md)). Copy the
backup volume and `pecklist-files` (attached files, which exports do not hold) off the cluster with
your volume snapshots or backup tool (Velero, Longhorn, restic, ...).

Look after the backups as you would the database: an export holds all the data and every
password hash. The `pecklist-backup` Secret is a full admin API key, so keep read access to Secrets
in the namespace to those who need it, and if the key leaks, revoke it under **Settings > Account >
API keys** and make a new one.

## Restoring

Restore from **Admin > Backups** in the app: upload a file (an export from the backup volume, for
example), or pick one of the server's snapshots. A whole-server restore is applied at the next
start, so the page offers the restart, which Kubernetes does by starting the pod again.

From the command line, run `import` in the running pod (it has the settings and the mounted
Secrets, so this works with PostgreSQL too), then restart it:

```bash
kubectl -n pecklist exec deployment/pecklist -- \
  pecklist import /data/snapshots/pecklist-YYYYMMDD-HHMMSS.json.gz --replace
kubectl -n pecklist rollout restart deployment/pecklist
```

Until the restart, the server keeps working from what it held before the import, so do this
while nobody is using it and restart straight away. The restore in the app is the safer way.

`import` reads a file inside the pod, and the image has no shell or `tar` for `kubectl cp`, so a
file from elsewhere goes through the upload in the app. See [backups](../guides/backups.md#from-the-command-line).

## Checking the files

The repository's CI builds every overlay with Kustomize and checks the result against the
Kubernetes schemas with kubeconform (`scripts/check-kubernetes.sh`). `scripts/kind-smoke.sh` goes
further: it starts a kind cluster in Docker, applies the `sqlite` and `postgres` overlays under the
`restricted` Pod Security level, waits for them to be ready, and removes the cluster again.
