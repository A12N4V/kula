with Ada.Text_IO;
package body Greeter is
   function Helper (S : String) return String is
   begin
      return S;
   end Helper;
   procedure Greet is
   begin
      Ada.Text_IO.Put_Line (Helper ("x"));
   end Greet;
end Greeter;
