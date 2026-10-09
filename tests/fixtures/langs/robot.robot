*** Settings ***
Library    SeleniumLibrary
Resource   common.resource
*** Keywords ***
Open App
    Helper Step    x
Helper Step
    [Arguments]    ${x}
    Log    ${x}
*** Test Cases ***
Login Works
    Open App
