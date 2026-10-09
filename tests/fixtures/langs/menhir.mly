%token <int> INT
%start <int> main
%%
main:
  | e = expr EOF { e }
expr:
  | i = INT { i }
  | e1 = expr PLUS e2 = term { e1 + e2 }
term:
  | i = INT { i }
