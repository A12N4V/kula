VERSION 0.8
IMPORT github.com/earthly/lib/utils AS utils
deps:
    FROM golang:1.22
build:
    FROM +deps
    BUILD +test
    DO utils+HELPER
test:
    RUN go test
