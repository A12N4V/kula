//! The published vocabulary: version, schema terms and example queries.

/// Version of the published vocabulary: 1 = the original set, 2 adds
/// Dependency, Env, usedBy and readsEnv (runtime layers), 3 adds Route and
/// handles (HTTP endpoints), 4 adds Table, mapsTable, migratesTable and
/// usesTable (ORM models and SQL migrations).
pub const VOCAB_VERSION: i64 = 4;

/// Every class and property, with its meaning: loaded into the graph itself so
/// a query can discover the schema (`SELECT ?p ?c { ?p rdfs:comment ?c }`).
pub const SCHEMA: &[(&str, &str, &str)] = &[
    ("Repository", "class", "The repository; code:repo."),
    ("File", "class", "A source file, by repository-relative path."),
    ("Symbol", "class", "Anything defined in code; every Function, Method, Class and Interface is one."),
    ("Function", "class", "A free function."),
    ("Method", "class", "A function that belongs to a class, type or impl."),
    ("Class", "class", "A class, struct, enum, record, type or module."),
    ("Interface", "class", "An interface, trait or protocol."),
    ("Package", "class", "An external package the code imports."),
    ("Dependency", "class", "An external package declared in a manifest."),
    ("Env", "class", "An environment variable the code reads or a key in .env.example."),
    ("Route", "class", "An HTTP endpoint declared in the code: Express, Fastify, Next.js, FastAPI, Flask, axum or Go net/http."),
    ("Table", "class", "A database table: mapped by a SQLAlchemy, Django, Prisma or Drizzle model, or made by a SQL migration."),
    ("Cluster", "class", "A functional cluster: symbols that call each other more than they call the rest."),
    ("Note", "class", "A person's note on the repo, a file or a symbol."),
    ("Memory", "class", "An agent's memory, anchored to the code it was written about."),
    ("Issue", "class", "A local issue, stored in git."),
    ("Guard", "class", "A rule from kula.toml that fences code off from agents."),
    ("name", "property", "The symbol, file or package name."),
    ("path", "property", "Repository-relative path of the file that defines it."),
    ("language", "property", "rust, python, javascript, typescript, tsx, go, java, c, cpp, csharp, ruby or php."),
    ("startLine", "property", "First line of the definition (1-based)."),
    ("endLine", "property", "Last line of the definition."),
    ("definedIn", "property", "Symbol → the File that defines it."),
    ("memberOf", "property", "Method or nested symbol → its enclosing Class."),
    ("calls", "property", "Symbol → Symbol it calls."),
    ("imports", "property", "File → File or Package it imports."),
    ("usedBy", "property", "Dependency → the File that imports it."),
    ("readsEnv", "property", "Symbol or File → the Env variable it reads."),
    ("handles", "property", "Route → the Symbol that serves it."),
    ("mapsTable", "property", "Model Symbol or File → the Table it maps."),
    ("migratesTable", "property", "SQL migration File → the Table it creates or alters."),
    ("usesTable", "property", "Symbol or File → a Table it reads or writes, through its model or raw SQL."),
    ("vocabVersion", "property", "The vocabulary version of this export."),
    ("inCluster", "property", "Symbol or File → its Cluster."),
    ("label", "property", "A cluster's label."),
    ("about", "property", "Note, Memory or Issue → the Repository, File or Symbol it is about."),
    ("body", "property", "Text of a note, memory or issue."),
    ("author", "property", "Who wrote it: a git user, or agent:<name>."),
    ("created", "property", "When, as xsd:dateTime."),
    ("stale", "property", "Memory: true when the code it was written about has changed since."),
    ("status", "property", "Issue: open or closed."),
    ("guardLevel", "property", "File or Symbol → open, review, scope, locked or hidden, for agents."),
    ("reason", "property", "Why a guard applies."),
    ("fences", "property", "Guard → each File it covers."),
];

/// Queries worth knowing, for `kula kg examples`, the UI and the MCP tool description.
pub const EXAMPLES: &[(&str, &str)] = &[
    (
        "Most-called symbols",
        "SELECT ?name ?path (COUNT(?caller) AS ?callers) WHERE {\n  ?s a kula:Symbol ; kula:name ?name ; kula:path ?path .\n  ?caller kula:calls ?s .\n} GROUP BY ?name ?path ORDER BY DESC(?callers) LIMIT 15",
    ),
    (
        "Functions no test reaches (by name)",
        "SELECT ?name ?path WHERE {\n  ?f a kula:Function ; kula:name ?name ; kula:path ?path .\n  FILTER NOT EXISTS { ?t kula:calls ?f ; kula:path ?tp . FILTER(CONTAINS(?tp, \"test\")) }\n  FILTER(!CONTAINS(?path, \"test\"))\n} ORDER BY ?path LIMIT 50",
    ),
    (
        "Files importing each other",
        "SELECT ?a ?b WHERE {\n  ?a kula:imports ?b . ?b kula:imports ?a .\n  FILTER(STR(?a) < STR(?b))\n}",
    ),
    (
        "Stale agent memories",
        "SELECT ?about ?body ?author WHERE {\n  ?m a kula:Memory ; kula:stale true ; kula:body ?body ; kula:author ?author ; kula:about ?about .\n}",
    ),
    (
        "Guarded code",
        "SELECT ?path ?level ?reason WHERE {\n  ?f a kula:File ; kula:path ?path ; kula:guardLevel ?level ; kula:reason ?reason .\n} ORDER BY ?level ?path",
    ),
    ("The vocabulary", "SELECT ?term ?meaning WHERE { ?term rdfs:comment ?meaning } ORDER BY ?term"),
];
