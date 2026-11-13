package main

import "example.com/m/car"

type Wheel struct{}

func (w *Wheel) Spin() int { return 2 }

func (w *Wheel) Roll() int { return w.Spin() }

func Remote() int {
	q := car.Wheel{}
	return q.Spin()
}

func Shadow() int {
	g := car.Wheel{}
	if true {
		g := Wheel{}
		_ = g
	}
	return g.Spin()
}

func Local() int {
	h := Wheel{}
	return h.Spin()
}
