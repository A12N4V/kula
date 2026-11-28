#!/bin/bash
source ./lib.sh
helper() { echo "$1"; }
function greet { helper "hi"; }
greet
