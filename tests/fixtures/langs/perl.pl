package Greeter;
use strict;
use List::Util qw(max);
require Data::Dumper;
sub helper { my ($s) = @_; return uc($s); }
sub greet { my $self = shift; return helper("x") . $self->name(); }
greet();
1;
