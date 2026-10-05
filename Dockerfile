# The API binary: built with the Go toolchain, shipped on scratch with nothing
# else. The Go version tracks go.mod; bump both together.
FROM golang:1.27-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
# github.com/remisb/dbbackup is private, so it comes straight from GitHub with
# the github_token build secret (the file .github-token; docs/backups.md). The
# token exists only during this RUN: it is in no layer and no image.
RUN apk add --no-cache git
ENV GOPRIVATE=github.com/remisb/dbbackup
RUN --mount=type=secret,id=github_token \
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="url.https://x-access-token:$(cat /run/secrets/github_token 2>/dev/null)@github.com/remisb/dbbackup.insteadOf" \
    GIT_CONFIG_VALUE_0="https://github.com/remisb/dbbackup" \
    go mod download

COPY cmd/ cmd/
COPY internal/ internal/

# Static (CGO off) for scratch. timetzdata embeds the zone database, which
# scratch lacks: API_ORG_TIMEZONE is loaded at startup and History and usage
# time count days in it.
RUN CGO_ENABLED=0 GOOS=linux go build -tags timetzdata -trimpath -ldflags='-s -w' -o /out/api ./cmd/api

FROM scratch
# Root certificates for a managed (TLS) database.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /out/api /api
USER 65532:65532
EXPOSE 8090
# Exec form: the binary is PID 1 and gets SIGTERM, so shutdown drains.
ENTRYPOINT ["/api"]
