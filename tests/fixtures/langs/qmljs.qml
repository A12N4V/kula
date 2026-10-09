import QtQuick 2.15
Item {
    function helper(s) { return s.toUpperCase(); }
    function greet(name) { return helper(name); }
    Rectangle { id: box }
}
