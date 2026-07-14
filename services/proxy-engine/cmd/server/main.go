package main

import (
	"log"

	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/config"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/server"
)

func main() {
	cfg := config.Load()

	proxyServer := server.New(cfg.Address())

	if err := proxyServer.Start(); err != nil {
		log.Fatalf("proxy engine stopped: %v", err)
	}
}
