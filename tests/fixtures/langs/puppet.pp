include apache
class web::server {
  web::helper { 'x': }
  notify { 'hi': }
}
define web::helper($x) { }
function web::greet(String $n) { upcase($n) }
