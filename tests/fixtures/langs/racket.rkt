#lang racket
(require racket/string)
(define (helper s) (string-upcase s))
(define (greet name) (helper name))
