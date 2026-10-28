# The docs job's image: MkDocs Material at the pinned versions (docs/requirements.txt), so the job
# does not pip-install on every run. Built by the ci-images job into $CI_REGISTRY_IMAGE/ci/docs;
# rebuilt weekly and whenever this file or requirements.txt changes.
FROM python:3.13-slim
COPY docs/requirements.txt /tmp/requirements.txt
RUN pip install --quiet --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt
