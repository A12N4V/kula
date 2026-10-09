{ pkgs ? import <nixpkgs> {} }:
let
  helper = s: pkgs.lib.toUpper s;
  greet = name: helper name;
  util = import ./util.nix;
in greet "x"
