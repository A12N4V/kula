library ieee;
use ieee.std_logic_1164.all;
entity counter is
  port (clk : in std_logic);
end entity;
architecture rtl of counter is
  function helper(x : integer) return integer is
  begin
    return x;
  end function;
begin
end architecture;
architecture top of counter is
begin
  u0: entity work.counter port map (clk => clk);
  u1: helper_comp port map (clk => clk);
end architecture;
