import 'package:flutter/material.dart';
class Greeter {
  String greet() { return helper('x'); }
}
String helper(String s) { return s.toUpperCase(); }
