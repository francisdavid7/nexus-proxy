FROM golang:1.26.4-alpine AS builder

WORKDIR /src

COPY go.mod ./
COPY cmd ./cmd

RUN CGO_ENABLED=0 \
    GOOS=linux \
    go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/nexus-node-agent \
    ./cmd/agent

FROM alpine:3.22

RUN addgroup -S nexus \
    && adduser -S -G nexus nexus

COPY --from=builder \
    /out/nexus-node-agent \
    /usr/local/bin/nexus-node-agent

USER nexus

ENTRYPOINT ["/usr/local/bin/nexus-node-agent"]
