(task_section name: (namespace (task_name (nametag) @def.function)))

(graph_task name: (task_name (nametag) @call))

((setting key: (key) @_k value: (_) @call) (#eq? @_k "inherit"))
