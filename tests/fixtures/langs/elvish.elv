use str
fn helper {|s| str:to-upper $s }
fn greet {|name| helper $name }
greet x
