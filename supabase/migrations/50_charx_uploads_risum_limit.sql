-- Raise CharX/RisuAI upload staging limit to support large .risum modules.
update storage.buckets
set file_size_limit = 838860800 -- 800 MiB
where id = 'charx-uploads';
