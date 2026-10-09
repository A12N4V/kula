(local json (require :json))
(fn helper [s] (string.upper s))
(fn greet [name] (helper name))
