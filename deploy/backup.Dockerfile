# The backup agent (github.com/remisb/dbbackup, cmd/dbbackup) on the database's
# own image, so pg_dump and pg_restore are exactly the server's version.
# docker-compose.prod.yml builds it with POSTGRES_IMAGE, the image db and
# migrate use, and DBBACKUP_VERSION, a tag of the dbbackup repository.
ARG POSTGRES_IMAGE=postgres:18-alpine

FROM golang:1.27-alpine AS build
RUN apk add --no-cache git
# The module is private: fetched straight from GitHub with the github_token build
# secret (the file .github-token; docs/backups.md), present only during this RUN.
ENV GOPRIVATE=github.com/remisb/dbbackup CGO_ENABLED=0
ARG DBBACKUP_VERSION=v0.1.0
RUN --mount=type=secret,id=github_token \
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="url.https://x-access-token:$(cat /run/secrets/github_token 2>/dev/null)@github.com/remisb/dbbackup.insteadOf" \
    GIT_CONFIG_VALUE_0="https://github.com/remisb/dbbackup" \
    go install -tags timetzdata -trimpath -ldflags="-s -w -X main.version=${DBBACKUP_VERSION}" \
        github.com/remisb/dbbackup/cmd/dbbackup@${DBBACKUP_VERSION}

FROM ${POSTGRES_IMAGE}
COPY --from=build /go/bin/dbbackup /usr/local/bin/dbbackup
# The default file:// target. A named volume mounted here starts as a copy of
# this directory, so the unprivileged postgres user can write to it.
RUN mkdir -p /backups && chown postgres:postgres /backups && chmod 700 /backups
VOLUME /backups
USER postgres
ENTRYPOINT ["dbbackup"]
CMD ["run"]
