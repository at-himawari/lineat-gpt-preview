-- 画像サポートのためのマイグレーション

-- メッセージテーブルに画像データ用のカラムを追加
-- 既に存在する場合はエラーが発生しますが、それは正常です

-- image_dataカラムを追加（既に存在する場合はスキップ）
SET @exist := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_SCHEMA = DATABASE() 
               AND TABLE_NAME = 'messages' 
               AND COLUMN_NAME = 'image_data');
SET @sqlstmt := IF(@exist = 0, 
                   'ALTER TABLE messages ADD COLUMN image_data MEDIUMTEXT NULL COMMENT ''Base64エンコードされた画像データ''',
                   'SELECT ''Column image_data already exists'' AS message');
PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- image_mime_typeカラムを追加（既に存在する場合はスキップ）
SET @exist := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_SCHEMA = DATABASE() 
               AND TABLE_NAME = 'messages' 
               AND COLUMN_NAME = 'image_mime_type');
SET @sqlstmt := IF(@exist = 0, 
                   'ALTER TABLE messages ADD COLUMN image_mime_type VARCHAR(50) NULL COMMENT ''画像のMIMEタイプ (image/jpeg, image/png, etc.)''',
                   'SELECT ''Column image_mime_type already exists'' AS message');
PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
