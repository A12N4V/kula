(bind function: (id) @def.function)

(field function: (fieldname (id) @def.function))

(functioncall . (id) @call)

(functioncall . (fieldaccess last: (id) @call))

(import (string) @import)

(importstr (string) @import)
