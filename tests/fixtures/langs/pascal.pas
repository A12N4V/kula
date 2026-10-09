program Demo;
uses SysUtils;
function Helper(s: string): string;
begin
  Helper := UpperCase(s);
end;
procedure Greet;
begin
  WriteLn(Helper('x'));
end;
begin
  Greet;
end.
