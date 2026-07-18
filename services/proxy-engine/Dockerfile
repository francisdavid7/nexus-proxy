FROM golang:1.26.4-alpine AS builder

WORKDIR /src

COPY go.mod go.sum* ./

RUN go mod download

COPY . .

RUN CGO_ENABLED=0 \
    GOOS=linux \
    go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/nexus-proxy \
    ./cmd/server

FROM alpine:3.22

RUN apk add --no-cache \
    ca-certificates \
    su-exec \
    tzdata \
    && addgroup -S nexus \
    && adduser -S nexus -G nexus

WORKDIR /app

COPY --from=builder /out/nexus-proxy /usr/local/bin/nexus-proxy
COPY docker-entrypoint.sh /usr/local/bin/nexus-proxy-entrypoint

RUN chmod 0755 \
    /usr/local/bin/nexus-proxy \
    /usr/local/bin/nexus-proxy-entrypoint

EXPOSE 8080 8443

ENTRYPOINT ["nexus-proxy-entrypoint"]
