(clazz . (identifier) @def.class)

(typeAlias . (identifier) @def.class)

(classMethod (methodHeader . (identifier) @def.function))

(objectMethod (methodHeader . (identifier) @def.function))

(unqualifiedAccessExpr (identifier) @call (argumentList))

(qualifiedAccessExpr (identifier) @call (argumentList))

(importClause (stringConstant) @import)

(importGlobClause (stringConstant) @import)
