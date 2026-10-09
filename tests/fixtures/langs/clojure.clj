(ns demo.greeter
  (:require [clojure.string :as str]))
(defn helper [s] (str/upper-case s))
(defn greet [name] (helper name))
(defrecord Point [x y])
(defprotocol Shape (area [this]))
