`include "defs.svh"
module counter(input clk, output reg [3:0] q);
  function automatic int helper(int x); return x; endfunction
  always @(posedge clk) q <= helper(q);
endmodule
module top; counter c0(.clk(clk), .q()); endmodule
