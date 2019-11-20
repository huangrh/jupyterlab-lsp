*** Settings ***
Suite Setup       Set Screenshot Directory    ${OUTPUT DIR}${/}screenshots${/}smoke
Resource          Keywords.robot

*** Variables ***
${XP MENU}        xpath://*[@id="jp-MainMenu"]
${XP HELP}        ${XP MENU}//*[contains(@class, "p-MenuBar-itemLabel")][text()="Help"]
${XP ABOUT}       xpath://*[contains(@class, "p-Menu-item")][text()="About JupyterLab"]
${CSS VERSION}    css:.jp-About-version
${CSS CLOSE}      css:.jp-Dialog-button.jp-About-button

*** Test Cases ***
Lab Version
    ${sel} =    Set Variable
    Mouse Over    ${XP HELP}
    Click Element    ${XP HELP}
    Mouse Over    ${XP ABOUT}
    Click Element    ${XP ABOUT}
    ${version} =    Get WebElement    ${CSS VERSION}
    Set Global Variable    ${LAB VERSION}    ${version.text.split(" ")[-1]}
    Capture Page Screenshot    00-version.png
    Click Element    ${CSS CLOSE}
