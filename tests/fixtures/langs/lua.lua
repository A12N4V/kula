local json = require("json")
local M = {}
function M.greet(name) return helper(name) end
function helper(s) return string.upper(s) end
local function private(x) return M.greet(x) end
return M
