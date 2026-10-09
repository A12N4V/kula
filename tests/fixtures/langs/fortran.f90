module util
contains
  function helper(x) result(y)
    integer :: x, y
    y = x
  end function helper
end module util
program main
  use util
  call greet()
contains
  subroutine greet()
    print *, helper(1)
  end subroutine greet
end program main
