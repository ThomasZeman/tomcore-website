azcopy copy .\static\assets https://tciostorf57b640c1dbe9606.blob.core.windows.net/$web/assets --recursive --metadata "Cache-Control:max-age=1209600" --overwrite ifSourceNewer
