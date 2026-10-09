(declProc name: (identifier) @def.function)

(declProc name: (genericDot (identifier) @def.method .))

(declType name: (identifier) @def.class (declClass))

(declType name: (identifier) @def.interface (declIntf))

(exprCall entity: (identifier) @call)

(exprCall entity: (exprDot rhs: (identifier) @call))

(statement (identifier) @call)

(declUses (moduleName) @import)
