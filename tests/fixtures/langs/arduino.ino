#include <Servo.h>
Servo servo;
int helper(int x) { return x * 2; }
void setup() { servo.attach(9); }
void loop() { delay(helper(10)); }
