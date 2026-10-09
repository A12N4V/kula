include common.mk
build: deps
	$(CC) -o app main.c
deps:
	echo deps
define helper
echo $(1)
endef
