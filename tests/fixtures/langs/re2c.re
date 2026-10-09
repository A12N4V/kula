/*!re2c
  re2c:define:YYCTYPE = char;
  digit = [0-9];
  number = digit+;
  number { return NUM; }
*/
