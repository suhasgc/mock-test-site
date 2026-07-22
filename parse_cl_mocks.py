import re
import json
import os

def extract_solution_div(html_text, start_pos):
    # Tracks div nesting depth to correctly balance and extract the whole solution div
    depth = 0
    pos = start_pos
    while pos < len(html_text):
        next_div = html_text.lower().find("<div", pos)
        next_close = html_text.lower().find("</div>", pos)
        
        if next_close == -1:
            break
            
        if next_div != -1 and next_div < next_close:
            depth += 1
            pos = next_div + 4
        else:
            depth -= 1
            pos = next_close + 6
            if depth == 0:
                return html_text[start_pos:pos]
    return None

def parse_cl_file(src_path, dest_path):
    try:
        with open(src_path, "r", encoding="utf-8") as f:
            html = f.read()
    except UnicodeDecodeError:
        with open(src_path, "r", encoding="latin-1") as f:
            html = f.read()
            
    # Extract test name
    test_name_match = re.search(r'<h2[^>]*id=["\']contentchngcate["\'][^>]*>(.*?)</h2>', html, re.IGNORECASE | re.DOTALL)
    test_name = test_name_match.group(1).strip() if test_name_match else "CL Mock Exam"
    test_name = re.sub(r'<[^>]*>', '', test_name).strip()
    
    # Split by question headers
    q_headers = list(re.finditer(r'<b[^>]*>\s*Q\.(\d+)\s*(?:\[\d+\])?\s*</b>', html, re.IGNORECASE))
    if not q_headers:
        print(f"  Warning: No questions found in {src_path}")
        return False
        
    blocks = []
    for i in range(len(q_headers)):
        start = q_headers[i].start()
        end = q_headers[i+1].start() if i+1 < len(q_headers) else len(html)
        blocks.append(html[start:end])
        
    # Extracted questions dict
    questions = {}
    sections = {}
    
    # Set section name based on file name or subfolder
    subfolder = os.path.basename(os.path.dirname(src_path))
    sec_name = "General Section"
    if "varc" in subfolder.lower():
        sec_name = "Verbal Ability & Reading Comprehension"
    elif "lrdi" in subfolder.lower() or "dilr" in subfolder.lower():
        sec_name = "Data Interpretation & Logical Reasoning"
    elif "qa" in subfolder.lower():
        sec_name = "Quantitative Ability"
        
    sections[sec_name] = []
    
    # Track directions
    block_0 = html[:q_headers[0].start()]
    dir_match = re.search(r'<td[^>]*class=["\']bg-info["\'][^>]*>(.*?)</td>', block_0, re.IGNORECASE | re.DOTALL)
    if not dir_match:
        dir_match = re.search(r'<b>Directions?\s+for\s+questions?\s*(?:\(?\d+\s+to\s+\d+\)?)?\s*:?</b>(.*?)(?=<table|<tr|<div|$)', block_0, re.IGNORECASE | re.DOTALL)
    default_dir = dir_match.group(1).strip() if dir_match else ""
    default_dir = re.sub(r'</?(?:tr|td|table|tbody|div|span)[^>]*>', '', default_dir).strip()
    
    current_passage_dir = default_dir
    
    for idx, block in enumerate(blocks):
        q_num = idx + 1
        q_id = str(20001 + idx)
        
        # Extract direction if it starts inside this block
        dir_in_block = re.search(r'<td[^>]*class=["\']bg-info["\'][^>]*>(.*?)</td>', block, re.IGNORECASE | re.DOTALL)
        if not dir_in_block:
            dir_in_block = re.search(r'<b>Directions?\s+for\s+questions?\s*(?:\(?\d+\s+to\s+\d+\)?)?\s*:?</b>(.*?)(?=<table|<tr|<div|$)', block, re.IGNORECASE | re.DOTALL)
        if dir_in_block:
            new_dir = dir_in_block.group(1).strip()
            new_dir = re.sub(r'</?(?:tr|td|table|tbody|div|span)[^>]*>', '', new_dir).strip()
            # Normalize direction header formatting
            new_dir = re.sub(r'^\s*<b>\s*Directions?\s*.*?\b', '<b>Directions ', new_dir, flags=re.IGNORECASE)
            current_passage_dir = new_dir
            
        # Radio buttons
        radio_matches = list(re.finditer(r'<input\s+[^>]*type=["\']?radio["\']?[^>]*>', block, re.IGNORECASE))
        is_tita = len(radio_matches) == 0
        
        # Question text
        if radio_matches:
            q_text_raw = block[:radio_matches[0].start()]
        else:
            sol_idx = block.find("<div id='quesSol")
            q_text_raw = block[:sol_idx] if sol_idx != -1 else block
            
        q_text = re.sub(r'</?(?:tr|td|table|tbody|div|span|p|b|i)[^>]*>', '', q_text_raw).strip()
        q_text = re.sub(r'^Q\.\d+\s*(?:\[\d+\])?\s*', '', q_text).strip()
        q_text = re.sub(r'\s+', ' ', q_text)
        
        # Options
        options = []
        if not is_tita:
            for opt_idx, rm in enumerate(radio_matches):
                start = rm.end()
                opt_raw = block[start:start+1000]
                
                # Look for structural tags to cut off option text
                tag_match = re.search(r'</?(?:tr|td|table|tbody|div|span|ul|li|input|button)\b|href=["\']#quesSol', opt_raw, re.IGNORECASE)
                if tag_match:
                    opt_text = opt_raw[:tag_match.start()].strip()
                else:
                    opt_text = opt_raw.strip()
                    
                # Clean format tags
                opt_text = re.sub(r'</?(?:b|i|u|span|p|br)[^>]*>', '', opt_text).strip()
                opt_text = re.sub(r'^\s*\d+\s*(?:&nbsp;)?\s*', '', opt_text).strip()
                opt_text = re.sub(r'\s+', ' ', opt_text)
                options.append(opt_text)
                
        # Solution and Correct response
        solution_html = "<p>Explanation not available.</p>"
        correct_response = [["1"]] # Default
        
        sol_start_idx = block.find("<div id='quesSol")
        if sol_start_idx != -1:
            sol_div = extract_solution_div(block, sol_start_idx)
            if sol_div:
                first_close = sol_div.find(">")
                solution_html = sol_div[first_close+1:-6].strip()
                
                ans_match = re.search(r'Correct\s+Answer\s*:\s*(?:<[^>]*>)*\s*([^\s<]+)', sol_div, re.IGNORECASE)
                if ans_match:
                    ans_val = ans_match.group(1).strip()
                    correct_response = [[ans_val]]
                    
        questions[q_id] = {
            "id": q_id,
            "marks": 3,
            "negative_marks": 0.0 if is_tita else 1.0,
            "is_input_type": is_tita,
            "is_multi_select": False,
            "instructions": current_passage_dir,
            "question_text": q_text,
            "options": options,
            "correct_response": correct_response,
            "solution": f"<div>{solution_html}</div>"
        }
        
        sections[sec_name].append(q_id)
        
    exam_data = {
        "name": test_name,
        "sections": sections,
        "questions": questions
    }
    
    with open(dest_path, "w", encoding="utf-8") as out:
        json.dump(exam_data, out, indent=4)
        
    print(f"  Successfully extracted {test_name} with {len(questions)} questions.")
    return True

# Batch process files
cl_dir = r"E:\mock-test-site\unpacked_cl_mocks\CL Mock 2017-2023"
html_files = []
for root, dirs, files in os.walk(cl_dir):
    for file in files:
        if file.endswith(".html"):
            html_files.append(os.path.join(root, file))

print(f"Found {len(html_files)} CL HTML mock files.")

processed_count = 0
for idx, html_path in enumerate(html_files):
    filename = os.path.basename(html_path)
    clean_name = re.sub(r'[\s_]+', '_', filename).replace('.html', '').lower()
    dest_path = f"E:\\mock-test-site\\cl_{clean_name}.json"
    
    print(f"[{idx+1}/{len(html_files)}] Parsing: {html_path}")
    if parse_cl_file(html_path, dest_path):
        processed_count += 1

print(f"Successfully processed {processed_count} CL mock files.")
