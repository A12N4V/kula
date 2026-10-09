local json = require(script.json)
type Point = { x: number }
local function helper(s: string): string return string.upper(s) end
function greet(name: string) return helper(name) end
