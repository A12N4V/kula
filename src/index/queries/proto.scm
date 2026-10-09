(message (message_name (identifier) @def.class))

(enum (enum_name (identifier) @def.class))

(service (service_name (identifier) @def.interface))

(rpc (rpc_name (identifier) @def.method))

(rpc (message_or_enum_type (identifier) @call))

(import path: (string) @import)
