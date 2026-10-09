library(dplyr)
source("utils.R")
greet <- function(name) {
  helper(name)
}
helper = function(s) toupper(s)
