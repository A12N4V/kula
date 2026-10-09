(import spork/json)
(defn helper [s] (string/ascii-upper s))
(defn greet [name] (helper name))
(defmacro unless [c & body] ~(if (not ,c) (do ,;body)))
