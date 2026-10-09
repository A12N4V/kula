defmodule Greeter do
  alias Demo.Util
  import Enum
  def greet(name), do: helper(name)
  defp helper(s), do: String.upcase(s)
end
