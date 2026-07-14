package server

import (
	"errors"
	"io"
	"log"
	"net"
	"time"
)

type Server struct {
	address string
}

func New(address string) *Server {
	return &Server{
		address: address,
	}
}

func (s *Server) Start() error {
	listener, err := net.Listen("tcp", s.address)
	if err != nil {
		return err
	}

	defer listener.Close()

	log.Printf("proxy engine listening on %s", s.address)

	for {
		connection, err := listener.Accept()
		if err != nil {
			log.Printf("failed to accept connection: %v", err)
			continue
		}

		go s.handleConnection(connection)
	}
}

func (s *Server) handleConnection(connection net.Conn) {
	defer connection.Close()

	remoteAddress := connection.RemoteAddr().String()

	log.Printf("new connection from %s", remoteAddress)

	if err := connection.SetDeadline(time.Now().Add(30 * time.Second)); err != nil {
		log.Printf("failed to set deadline for %s: %v", remoteAddress, err)
		return
	}

	buffer := make([]byte, 4096)

	bytesRead, err := connection.Read(buffer)
	if err != nil {
		if !errors.Is(err, io.EOF) {
			log.Printf("failed reading from %s: %v", remoteAddress, err)
		}

		return
	}

	log.Printf(
		"received %d bytes from %s",
		bytesRead,
		remoteAddress,
	)

	response := []byte("Nexus Proxy Engine is running\n")

	if _, err := connection.Write(response); err != nil {
		log.Printf("failed writing to %s: %v", remoteAddress, err)
	}
}
