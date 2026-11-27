# The API binary: built with the Go toolchain, shipped on scratch with nothing
# else. The Go version tracks go.mod; bump both together.
FROM golang:1.27.3-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
# github.com/remisb/dbbackup, github.com/remisb/pdf-mini and
# github.com/remisb/applauncher are private, so they come straight from GitHub
# with the github_token build secret (the file .github-token, read-only on the
# three; docs/backups.md). The token exists only
# during this RUN: it is in no layer and no image.
RUN apk add --no-cache git
ENV GOPRIVATE=github.com/remisb/dbbackup,github.com/remisb/pdf-mini,github.com/remisb/applauncher
RUN --mount=type=secret,id=github_token \
    TOKEN="$(cat /run/secrets/github_token 2>/dev/null)" && \
    GIT_CONFIG_COUNT=3 \
    GIT_CONFIG_KEY_0="url.https://x-access-token:${TOKEN}@github.com/remisb/dbbackup.insteadOf" \
    GIT_CONFIG_VALUE_0="https://github.com/remisb/dbbackup" \
    GIT_CONFIG_KEY_1="url.https://x-access-token:${TOKEN}@github.com/remisb/pdf-mini.insteadOf" \
    GIT_CONFIG_VALUE_1="https://github.com/remisb/pdf-mini" \
    GIT_CONFIG_KEY_2="url.https://x-access-token:${TOKEN}@github.com/remisb/applauncher.insteadOf" \
    GIT_CONFIG_VALUE_2="https://github.com/remisb/applauncher" \
    go mod download

COPY cmd/ cmd/
COPY internal/ internal/

# Static (CGO off) for scratch. timetzdata embeds the zone database, which
# scratch lacks: API_ORG_TIMEZONE is loaded at startup and History and usage
# time count days in it.
# API_COMMIT (`make prod-build` passes `git describe`) names the build in
# GET /ready and the startup log. Declared here, after the module download, so a
# new commit does not invalidate that layer.
# Go's build cache is a BuildKit cache mount, kept between builds, so a deploy
# recompiles only the packages that changed. The modules stay in the layer
# above, not in a mount: an emptied cache must never leave the build to fetch
# the private ones without the token.
ARG API_COMMIT=
RUN --mount=type=cache,id=ppe-go-build,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -tags timetzdata -trimpath -ldflags="-s -w -X main.commit=${API_COMMIT}" -o /out/api ./cmd/api
# The published apps' folder (API_APPS_DIR), the API user's: a new named
# volume mounted on it takes its owner from here. Scratch has no mkdir.
# And /tmp, which scratch lacks too: Go's multipart parsing writes every upload
# part over its 1 MiB in memory to a temp file there, so without it any photo,
# signed form or scan over 1 MiB answers 400 (TestAPIImageHasTmp). Copied as
# a child of /out/root: COPY of a folder copies its contents and makes the
# target itself root's 0755, which the API's user could not write.
RUN mkdir -p /out/published /out/root/tmp && chmod 1777 /out/root/tmp

# The worker (`api -worker`, ADR 0008 decision 9, docs/specs/outbox-service.md):
# the same binary on Debian with the tools it runs, Poppler (pdftotext,
# pdftoppm) and Tesseract with English, Lithuanian, Russian and orientation
# and script detection (eng and osd come with tesseract-ocr), and LibreOffice
# Writer, headless, with fonts for Lithuanian and Russian and Word's Calibri
# and Cambria metrics, for DOCX templates (phase 8). Built with
# `--target docworker`; the API's image below stays scratch, and is the
# default target as the last stage (TestAPIImageHasTmp).
FROM debian:trixie-slim AS docworker
RUN apt-get update && \
    apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-lit tesseract-ocr-rus \
        libreoffice-writer-nogui fonts-liberation2 fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea && \
    rm -rf /var/lib/apt/lists/*
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /out/api /api
USER 65532:65532
# Exec form: the binary is PID 1 and gets SIGTERM, so running jobs are given back.
ENTRYPOINT ["/api", "-worker"]
# Healthy while the worker records its heartbeat (every 30 s).
HEALTHCHECK --interval=30s --timeout=5s --start-period=1m --retries=3 CMD ["/api", "-healthcheck-worker"]

FROM scratch
# Root certificates for a managed (TLS) database.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /out/api /api
COPY --from=build --chown=65532:65532 /out/published /srv/published
COPY --from=build /out/root/ /
USER 65532:65532
EXPOSE 8090
# Exec form: the binary is PID 1 and gets SIGTERM, so shutdown drains.
ENTRYPOINT ["/api"]
# Scratch has no curl: the binary probes its own GET /ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=1m --retries=3 CMD ["/api", "-healthcheck"]
