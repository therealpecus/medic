#!/bin/sh
tr -d '\n' | sed -e 's/\[/[\
/g' -e 's/\},/},\
/g' -e 's/\]\[//g';
