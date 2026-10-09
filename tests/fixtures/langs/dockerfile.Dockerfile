FROM golang:1.22 AS build
RUN go build -o /app .
FROM alpine AS runtime
COPY --from=build /app /app
