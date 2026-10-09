Import-Module ./Util.psm1
. ./lib.ps1
function Get-Greeting { param($n) Invoke-Helper $n }
function Invoke-Helper($s) { Write-Output $s }
class Greeter { [string] Greet() { return "x" } }
