include lib.fs
: helper ( n -- n ) 1+ ;
: greet ( n -- ) helper . ;
5 greet
