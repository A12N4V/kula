package main

// Interface satisfaction by method-name match: inferred, never resolved.
type Greeter interface {
	Greet() string
}

func Call(g Greeter) string { return g.Greet() }

// Unknown call: no import declares Missing; it stays guessed.
func Lost() string { return Missing() }
